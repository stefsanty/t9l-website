import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * v1.89.0 — step 1 of legacy table cleanup. The `Goal` and `Assist`
 * tables are decommissioned; live writes go through `MatchEvent` only.
 *
 * This guard pins the "no legacy writers" invariant: nothing under
 * `src/` may call `prisma.goal.{create,update,delete,deleteMany,upsert}`
 * or the same on `prisma.assist`. Source-level grep, comments + string
 * literals stripped so doc mentions don't trip the test.
 *
 * Stash-pop sanity: re-introducing the v1.88.0 `addGoal` /
 * `deleteGoal` writer pair (the only remaining writer site at the
 * start of v1.89.0) re-fails the corresponding cases.
 *
 * Step 2 (separate PR) drops the `Goal` and `Assist` tables outright
 * via a Prisma migration.
 */

const FORBIDDEN = [
  /\bprisma\.goal\.(create|update|delete|deleteMany|upsert|createMany|updateMany)\s*\(/,
  /\bprisma\.assist\.(create|update|delete|deleteMany|upsert|createMany|updateMany)\s*\(/,
  /\btx\.goal\.(create|update|delete|deleteMany|upsert|createMany|updateMany)\s*\(/,
  /\btx\.assist\.(create|update|delete|deleteMany|upsert|createMany|updateMany)\s*\(/,
] as const

const ROOTS = ['src']
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

function stripCommentsAndStrings(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      const nl = text.indexOf('\n', i)
      if (nl === -1) break
      i = nl
      continue
    }
    if (c === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2)
      if (close === -1) break
      i = close + 2
      continue
    }
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

describe('v1.89.0 — legacy Goal/Assist writers fully removed from src/', () => {
  const repoRoot = process.cwd()

  for (const pattern of FORBIDDEN) {
    it(`no source file matches ${pattern}`, () => {
      const offenders: string[] = []
      for (const root of ROOTS) {
        const files = walk(join(repoRoot, root))
        for (const f of files) {
          const text = readFileSync(f, 'utf8')
          const stripped = stripCommentsAndStrings(text)
          if (pattern.test(stripped)) {
            offenders.push(f.slice(repoRoot.length + 1))
          }
        }
      }
      expect(offenders).toEqual([])
    })
  }

  it('no source file calls the deleted addGoal / deleteGoal / updateMatchScore actions', () => {
    const callers: Array<{ file: string; symbol: string }> = []
    const symbols = ['addGoal', 'deleteGoal', 'updateMatchScore'] as const
    for (const root of ROOTS) {
      const files = walk(join(repoRoot, root))
      for (const f of files) {
        const text = readFileSync(f, 'utf8')
        const stripped = stripCommentsAndStrings(text)
        for (const sym of symbols) {
          // Match function-call shape `<sym>(` or import shape `, <sym> ,`.
          const callRe = new RegExp(`\\b${sym}\\s*\\(`)
          const importRe = new RegExp(`\\b${sym}\\b`)
          if (callRe.test(stripped) || importRe.test(stripped)) {
            callers.push({ file: f.slice(repoRoot.length + 1), symbol: sym })
          }
        }
      }
    }
    expect(callers).toEqual([])
  })

  it('the legacy /admin/matches route directory is gone', () => {
    const adminMatches = join(repoRoot, 'src/app/admin/matches')
    expect(existsSync(adminMatches)).toBe(false)
  })

  it('AdminSidebar nav no longer links to /admin/matches', () => {
    const sidebar = readFileSync(
      join(repoRoot, 'src/components/admin/AdminSidebar.tsx'),
      'utf8',
    )
    const stripped = stripCommentsAndStrings(sidebar)
    expect(stripped).not.toMatch(/\/admin\/matches/)
  })

  it('getLeagueStats no longer fetches the legacy Goal table', () => {
    const adminData = readFileSync(
      join(repoRoot, 'src/lib/admin-data.ts'),
      'utf8',
    )
    const stripped = stripCommentsAndStrings(adminData)
    // The whole file should have zero `prisma.goal.*` calls now (covered by
    // the FORBIDDEN sweep above) — this case pins the specific reader.
    expect(stripped).not.toMatch(/prisma\.goal\.findMany\s*\(/)
    expect(stripped).not.toMatch(/getMatch\s*\(\s*id\s*:/)
  })

  it('StatsTab no longer accepts a `goals` prop or carries the legacy `void goals` reader', () => {
    const statsTab = readFileSync(
      join(repoRoot, 'src/components/admin/StatsTab.tsx'),
      'utf8',
    )
    const stripped = stripCommentsAndStrings(statsTab)
    expect(stripped).not.toMatch(/\bvoid\s+goals\b/)
    expect(stripped).not.toMatch(/\bgoals\s*:\s*GoalRow\[\]/)
    expect(stripped).not.toMatch(/\bbuildScorerStats\s*\(/)
  })

  it('admin event-CRUD revalidate paths no longer include the deleted /admin/matches route', () => {
    const actions = readFileSync(
      join(repoRoot, 'src/app/admin/leagues/actions.ts'),
      'utf8',
    )
    const stripped = stripCommentsAndStrings(actions)
    expect(stripped).not.toMatch(/`\/admin\/matches\/\$\{[^}]+\}`/)
  })
})
