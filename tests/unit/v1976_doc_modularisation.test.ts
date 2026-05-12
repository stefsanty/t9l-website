/**
 * v1.97.6 — Doc modularisation regression target.
 *
 * Splits CLAUDE.md into three documents so it stays a slim index:
 *   1. docs/methodology.md — portable agent + ship conventions (stack-
 *      agnostic; another project can copy verbatim).
 *   2. docs/ledger.md — active per-PR ledger (the most-recent paragraphs).
 *   3. CLAUDE.md — slim index pointing at methodology + ledger + topical
 *      docs, plus the t9l-specific standing rules that don't belong
 *      anywhere else.
 *
 * Tests pin:
 *   - APP_VERSION at 1.97.6+.
 *   - docs/methodology.md exists and carries the portable rule sections.
 *   - docs/ledger.md exists and starts with a v1.97.x bullet (the active
 *     ledger's top entry).
 *   - CLAUDE.md is slim (≤ 100 lines) — guards against ledger entries
 *     creeping back in.
 *   - CLAUDE.md references both methodology.md and ledger.md as pointers
 *     so future agents can find them.
 *   - CLAUDE.md NO LONGER carries the verbatim ledger paragraphs (the
 *     `## Recent ledger` section is gone).
 *   - Project-specific standing rules retained in CLAUDE.md:
 *     admin-orthogonal, no-exports-from-use-server, cache-invalidation
 *     canonical, migration SQL pointer.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
const METHODOLOGY_PATH = join(REPO_ROOT, 'docs/methodology.md')
const LEDGER_PATH = join(REPO_ROOT, 'docs/ledger.md')

describe('v1.97.6 — version pin', () => {
  it('APP_VERSION at 1.97.6 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(97\.([6-9]|\d{2,})|9[89]\.\d+|\d{3,}\.\d+)['"]|APP_VERSION\s*=\s*['"][2-9]\.\d+\.\d+['"]/,
    )
  })

  it('CLAUDE.md current-release header lists v1.97.6 or higher', () => {
    expect(CLAUDE_MD).toMatch(
      /\*\*Current release:\*\*\s*(?:v1\.(?:97\.([6-9]|\d{2,})|9[89]\.\d+|\d{3,}\.\d+)|v[2-9]\.\d+\.\d+)/,
    )
  })
})

describe('v1.97.6 — docs/methodology.md exists with portable conventions', () => {
  it('file exists at docs/methodology.md', () => {
    expect(existsSync(METHODOLOGY_PATH)).toBe(true)
  })

  const METHODOLOGY = existsSync(METHODOLOGY_PATH)
    ? readFileSync(METHODOLOGY_PATH, 'utf8')
    : ''

  it('carries the stale-worktree protocol section', () => {
    expect(METHODOLOGY).toMatch(/##\s+Stale-worktree protocol/i)
  })

  it('carries the plan-then-ship autonomy section', () => {
    expect(METHODOLOGY).toMatch(/##\s+Plan-then-ship autonomy/i)
  })

  it('carries the auto-merge policy section', () => {
    expect(METHODOLOGY).toMatch(/##\s+Auto-merge policy/i)
  })

  it('carries the version-bump rule section', () => {
    expect(METHODOLOGY).toMatch(/##\s+Version-bump rule/i)
  })

  it('carries the per-push reporting 3-point template', () => {
    expect(METHODOLOGY).toMatch(/##\s+Per-push reporting/i)
    expect(METHODOLOGY).toMatch(/On push/i)
    expect(METHODOLOGY).toMatch(/On merge/i)
    expect(METHODOLOGY).toMatch(/On prod live/i)
  })

  it('carries the ORM migration discipline section (Prisma + generic)', () => {
    expect(METHODOLOGY).toMatch(/##\s+ORM migration discipline/i)
    expect(METHODOLOGY).toMatch(/NEVER hand-author migration SQL/)
  })

  it('carries the post-deploy 3-check pattern', () => {
    expect(METHODOLOGY).toMatch(/##\s+Post-deploy verification/i)
    expect(METHODOLOGY).toMatch(/HTTP 200/)
    expect(METHODOLOGY).toMatch(/Key tables remain populated/i)
    expect(METHODOLOGY).toMatch(/failed schema migrations/i)
  })

  it('carries the rollback layer model section', () => {
    expect(METHODOLOGY).toMatch(/##\s+Rollback layer model/i)
  })

  it('carries the subagent workflow section', () => {
    expect(METHODOLOGY).toMatch(/##\s+Working with subagents/i)
  })

  it('carries the Bash discipline section', () => {
    expect(METHODOLOGY).toMatch(/##\s+Bash discipline/i)
    expect(METHODOLOGY).toMatch(/Never chain bash commands/i)
  })

  it('is stack-agnostic — does NOT name t9l, Tennozu, or t9l.me at the rule level', () => {
    // The methodology doc is meant to be copy-pasted into other projects.
    // Specific project names like "T9L", "Tennozu", or "t9l.me" indicate
    // accidental project-leakage and should be replaced with placeholders.
    expect(METHODOLOGY).not.toMatch(/\bT9L\b/)
    expect(METHODOLOGY).not.toMatch(/\bTennozu\b/)
    expect(METHODOLOGY).not.toMatch(/\bt9l\.me\b/)
  })
})

describe('v1.97.6 — docs/ledger.md exists with active ledger entries', () => {
  it('file exists at docs/ledger.md', () => {
    expect(existsSync(LEDGER_PATH)).toBe(true)
  })

  const LEDGER = existsSync(LEDGER_PATH)
    ? readFileSync(LEDGER_PATH, 'utf8')
    : ''

  it('top bullet is a recent v1.9x.x release (active ledger discipline)', () => {
    const firstBullet = LEDGER.match(/-\s+\*\*v(\d+\.\d+\.\d+)\*\*/)
    expect(firstBullet).toBeTruthy()
    expect(firstBullet![1]).toMatch(
      /^(?:1\.(?:9[0-9]\.\d+|\d{3,}\.\d+)|[2-9]\.\d+\.\d+)$/,
    )
  })

  it('points readers at ledger-archive.md for older entries', () => {
    expect(LEDGER).toMatch(/ledger-archive\.md/)
  })

  it('contains multiple ledger entries (at least 10)', () => {
    const bullets = LEDGER.match(/^-\s+\*\*v\d+\.\d+\.\d+\*\*/gm) ?? []
    expect(bullets.length).toBeGreaterThanOrEqual(10)
  })
})

describe('v1.97.6 — CLAUDE.md is a slim index', () => {
  it('is ≤ 100 lines (slim-index discipline)', () => {
    const lines = CLAUDE_MD.split('\n').length
    expect(lines).toBeLessThanOrEqual(100)
  })

  it('points at docs/methodology.md', () => {
    expect(CLAUDE_MD).toMatch(/docs\/methodology\.md/)
  })

  it('points at docs/ledger.md', () => {
    expect(CLAUDE_MD).toMatch(/docs\/ledger\.md/)
  })

  it('no longer carries verbatim "## Recent ledger" section', () => {
    // Regression target: the active ledger lives in docs/ledger.md now.
    // If a future PR drops a ledger paragraph back into CLAUDE.md the
    // slim-index discipline gets re-eroded.
    expect(CLAUDE_MD).not.toMatch(/^##\s+Recent ledger/m)
  })
})

describe('v1.97.6 — project-specific rules retained in CLAUDE.md', () => {
  it('admin-orthogonal-UX rule pointer retained', () => {
    expect(CLAUDE_MD).toMatch(/Admin-orthogonal-UX/i)
    expect(CLAUDE_MD).toMatch(/docs\/admin-orthogonal-ux\.md/)
  })

  it('no-exports-from-use-server rule retained', () => {
    expect(CLAUDE_MD).toMatch(/No exports from `'use server'`/)
  })

  it('cache-invalidation canonical rule retained', () => {
    expect(CLAUDE_MD).toMatch(/revalidate.*domain/)
    expect(CLAUDE_MD).toMatch(/docs\/cache-invalidation\.md/)
  })

  it('migration-SQL Prisma-specific note retained with pointer', () => {
    expect(CLAUDE_MD).toMatch(/Migration SQL authoring/i)
    expect(CLAUDE_MD).toMatch(/prisma migrate dev --create-only/)
    expect(CLAUDE_MD).toMatch(/docs\/migration-sql-lessons\.md/)
  })

  it('post-deploy verification pointer to release-and-ship.md retained', () => {
    expect(CLAUDE_MD).toMatch(/Post-deploy verification/i)
    expect(CLAUDE_MD).toMatch(
      /docs\/release-and-ship\.md#post-deploy-verification/i,
    )
  })
})
