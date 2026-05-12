/**
 * v1.95.1 — Auto-merge policy standing rule.
 *
 * Codifies the existing autonomy: when Unit + tsc tests pass, post-push
 * self-verification surfaces no issues, and no architectural ambiguity
 * was flagged, the executor SHOULD merge via `gh pr merge --squash
 * --admin` without waiting for explicit user confirmation. Symmetric to
 * the v1.65.x plan-then-ship autonomy.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.95.1.
 *   2. CLAUDE.md Standing-rules section carries the one-line summary
 *      adjacent to the **Plan-then-ship** rule, with a pointer to the
 *      full policy in docs/release-and-ship.md.
 *   3. docs/release-and-ship.md gains an `## Auto-merge policy` section
 *      stating the three conditions (Unit+tsc / self-verification /
 *      no ambiguity) and the four explicit confirmation-required cases.
 *   4. The policy is conditional (SHOULD merge IFF conditions hold) —
 *      no language suggesting unconditional / bypass-everything merging.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
const RELEASE_DOC = readFileSync(
  join(REPO_ROOT, 'docs/release-and-ship.md'),
  'utf8',
)

describe('v1.95.1 — version bump', () => {
  it('APP_VERSION is 1.95.1 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(95\.(1|[2-9]|\d{2,})|9[6-9]\.\d+|\d{3,}\.\d+)['"]|APP_VERSION\s*=\s*['"][2-9]\.\d+\.\d+['"]/,
    )
  })
})

describe('v1.95.1 — CLAUDE.md standing-rules entry', () => {
  it('Standing rules section carries an Auto-merge policy line', () => {
    expect(CLAUDE_MD).toMatch(/\*\*Auto-merge policy\.\*\*/)
  })

  it('mentions the three conditions: tests green, self-verification, no ambiguity', () => {
    const block = CLAUDE_MD.match(
      /\*\*Auto-merge policy\.\*\*[\s\S]+?(?=\n\n\*\*[A-Z]|\n##\s)/,
    )
    expect(block).toBeTruthy()
    const body = block![0]
    expect(body).toMatch(/Unit \+ tsc/)
    expect(body).toMatch(/self-verification/)
    expect(body).toMatch(/no architectural ambiguity/)
  })

  it('references the canonical gh command', () => {
    const block = CLAUDE_MD.match(
      /\*\*Auto-merge policy\.\*\*[\s\S]+?(?=\n\n\*\*[A-Z]|\n##\s)/,
    )
    expect(block![0]).toMatch(/gh pr merge --squash --admin/)
  })

  it('points readers at the full policy in docs/release-and-ship.md', () => {
    const block = CLAUDE_MD.match(
      /\*\*Auto-merge policy\.\*\*[\s\S]+?(?=\n\n\*\*[A-Z]|\n##\s)/,
    )
    expect(block![0]).toMatch(/docs\/release-and-ship\.md#auto-merge-policy/)
  })
})

describe('v1.95.1 — docs/release-and-ship.md auto-merge section', () => {
  it('declares an `## Auto-merge policy` section', () => {
    expect(RELEASE_DOC).toMatch(/^## Auto-merge policy\s*$/m)
  })

  it('section states the three conditions explicitly', () => {
    const section = RELEASE_DOC.match(
      /^## Auto-merge policy[\s\S]+?(?=^## )/m,
    )
    expect(section).toBeTruthy()
    const body = section![0]
    expect(body).toMatch(/Unit \+ tsc tests pass/)
    expect(body).toMatch(/Post-push self-verification/)
    expect(body).toMatch(/No architectural ambiguity/)
  })

  it('section lists the four explicit confirmation-required cases', () => {
    const section = RELEASE_DOC.match(
      /^## Auto-merge policy[\s\S]+?(?=^## )/m,
    )!
    const body = section[0]
    expect(body).toMatch(/Security trade-off/)
    expect(body).toMatch(/Destructive migration/)
    expect(body).toMatch(/Scope question/)
    expect(body).toMatch(/Stop condition triggered/)
  })

  it('section sits between Plan-then-ship autonomy and Backups & rollback runbook', () => {
    const planIdx = RELEASE_DOC.indexOf('## Plan-then-ship autonomy')
    const autoIdx = RELEASE_DOC.indexOf('## Auto-merge policy')
    const backupIdx = RELEASE_DOC.indexOf('## Backups & rollback runbook')
    expect(planIdx).toBeGreaterThan(-1)
    expect(autoIdx).toBeGreaterThan(planIdx)
    expect(backupIdx).toBeGreaterThan(autoIdx)
  })
})

describe('v1.95.1 — policy is conditional, not unconditional', () => {
  it('does NOT describe auto-merge as unconditional / bypass-everything', () => {
    // The CLAUDE.md line + the docs section must both make clear that
    // confirmation IS required when ambiguity/risk is flagged. The
    // policy is SHOULD-on-clean-path, not MUST-always.
    const section = RELEASE_DOC.match(
      /^## Auto-merge policy[\s\S]+?(?=^## )/m,
    )!
    expect(section[0]).toMatch(/Surface for confirmation ONLY when/)
    expect(section[0]).not.toMatch(/unconditional auto-merge/i)
    expect(section[0]).not.toMatch(/bypass all checks/i)
  })
})
