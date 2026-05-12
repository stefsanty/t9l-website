/**
 * v1.95.2 — Auto-merge reporting requirement.
 *
 * Extends the v1.95.1 auto-merge policy with an explicit requirement:
 * after every self-merge, the executor MUST surface a final report
 * (PR #, merge SHA, version, what shipped, post-deploy verification
 * result). Silent exits after a clean merge are forbidden.
 *
 * Tests pin:
 *   1. APP_VERSION bumped to 1.95.2.
 *   2. docs/release-and-ship.md Auto-merge policy section carries the
 *      "Always report back on merge" paragraph with the required fields.
 *   3. CLAUDE.md standing-rule line mentions the reporting requirement.
 *   4. The report-back rule names the four required fields.
 *   5. The rule forbids silent exit ("do NOT end the session silently").
 *   6. The rule covers the partial-deploy / timeout case.
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

describe('v1.95.2 — version bump', () => {
  it('APP_VERSION is 1.95.2 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(95\.(2|[3-9]|\d{2,})|9[6-9]\.\d+|\d{3,}\.\d+)['"]|APP_VERSION\s*=\s*['"][2-9]\.\d+\.\d+['"]/,
    )
  })
})

describe('v1.95.2 — docs/release-and-ship.md report-back requirement', () => {
  const getAutoMergeSection = () => {
    const match = RELEASE_DOC.match(/^## Auto-merge policy[\s\S]+?(?=^## )/m)
    expect(match).toBeTruthy()
    return match![0]
  }

  it('section contains "Always report back on merge" heading', () => {
    expect(getAutoMergeSection()).toMatch(/Always report back on merge/)
  })

  it('section requires reporting PR number', () => {
    expect(getAutoMergeSection()).toMatch(/PR #/)
  })

  it('section requires reporting merge SHA', () => {
    expect(getAutoMergeSection()).toMatch(/merge SHA/)
  })

  it('section requires reporting version', () => {
    expect(getAutoMergeSection()).toMatch(/version/)
  })

  it('section requires reporting post-deploy verification result', () => {
    expect(getAutoMergeSection()).toMatch(/post-deploy verification/)
  })

  it('section explicitly forbids silent exit after clean merge', () => {
    expect(getAutoMergeSection()).toMatch(/do NOT end the session silently/i)
  })

  it('section covers the partial-deploy / timeout case', () => {
    expect(getAutoMergeSection()).toMatch(/deploy still in progress/)
  })
})

describe('v1.95.2 — CLAUDE.md standing-rule mentions reporting', () => {
  it('Auto-merge policy line references the report-back obligation', () => {
    // Match the full paragraph (ends at blank-line + next bold rule or section heading)
    const block = CLAUDE_MD.match(
      /\*\*Auto-merge policy\.\*\*[\s\S]+?(?=\n\n\*\*[A-Z]|\n##\s)/,
    )
    expect(block).toBeTruthy()
    const body = block![0]
    // Should mention reporting back after self-merge
    expect(body).toMatch(/report back|never go silent/i)
  })
})
