import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

/**
 * v1.73.6 — Admin settings dark-text-on-dark-background regression target.
 *
 * Bug surfaced in light mode on `/admin/leagues/[id]/settings`: the Player
 * Fee section (LeagueFeesEditor, shipped v1.66.0) and Planned Roster
 * section (LeaguePlannedRosterEditor, shipped v1.67.0) rendered black text
 * on a black background — unreadable.
 *
 * Root cause: both components used the public-site responsive tokens
 * `text-fg-high` / `text-fg-mid` / `text-fg-low`, which flip to near-black
 * (`rgba(26, 15, 30, 0.95)`) under `html.light` or `prefers-color-scheme:
 * light`. The admin shell forces a dark surface (`bg-admin-surface`
 * = `#141618`) regardless of mode but does NOT override the `--fg-*` tokens,
 * so admin sections that consumed those tokens went dark-on-dark in light
 * mode.
 *
 * Fix: replace `text-fg-high/mid/low` with the admin-namespaced static
 * tokens `text-admin-text` / `text-admin-text2` / `text-admin-text3`,
 * matching the convention in working admin components (see SettingsTab).
 *
 * Also: the inputs were missing explicit text-color classes, so user-typed
 * content fell back to the browser default (black). Inputs now carry
 * `text-admin-text`.
 *
 * Regression targets:
 *   - Neither file may carry `text-fg-high/mid/low` again (the canonical
 *     wrong-namespace token set).
 *   - Neither file may carry hardcoded `text-black` / `bg-white` /
 *     `text-gray-900` style raw colors.
 *   - All inputs must declare an explicit `text-admin-text` class so the
 *     typed value is visible against `bg-admin-surface2`.
 */

function readSrc(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const FEES_PATH = 'src/components/admin/LeagueFeesEditor.tsx'
const ROSTER_PATH = 'src/components/admin/LeaguePlannedRosterEditor.tsx'

describe('v1.73.6 — admin settings sections do not strand text on dark surface', () => {
  describe('LeagueFeesEditor', () => {
    const src = readSrc(FEES_PATH)

    it('does not use text-fg-high (public-site responsive token; flips to dark in light mode)', () => {
      expect(src).not.toMatch(/\btext-fg-high\b/)
    })

    it('does not use text-fg-mid', () => {
      expect(src).not.toMatch(/\btext-fg-mid\b/)
    })

    it('does not use text-fg-low', () => {
      expect(src).not.toMatch(/\btext-fg-low\b/)
    })

    it('uses admin-namespaced text tokens for the heading', () => {
      expect(src).toMatch(/text-admin-text\b/)
    })

    it('uses admin-namespaced text token for secondary copy', () => {
      expect(src).toMatch(/text-admin-text2\b/)
    })

    it('uses admin-namespaced text token for tertiary / dim copy', () => {
      expect(src).toMatch(/text-admin-text3\b/)
    })

    it('does not hardcode raw black / white text or background colors', () => {
      expect(src).not.toMatch(/\btext-black\b/)
      expect(src).not.toMatch(/\btext-white\b/)
      expect(src).not.toMatch(/\btext-gray-(?:9\d{2})\b/)
      expect(src).not.toMatch(/\bbg-white\b/)
      expect(src).not.toMatch(/\bbg-black\b/)
    })

    it('every <input> declares text-admin-text so typed values stay visible', () => {
      const inputBlocks = src.match(/<input[\s\S]*?\/>/g) ?? []
      expect(inputBlocks.length).toBeGreaterThan(0)
      for (const block of inputBlocks) {
        expect(block).toMatch(/text-admin-text\b/)
      }
    })

    it('preserves the canonical bg-admin-surface card shell', () => {
      expect(src).toMatch(/bg-admin-surface\b/)
      expect(src).toMatch(/border-admin-border\b/)
    })
  })

  describe('LeaguePlannedRosterEditor', () => {
    const src = readSrc(ROSTER_PATH)

    it('does not use text-fg-high', () => {
      expect(src).not.toMatch(/\btext-fg-high\b/)
    })

    it('does not use text-fg-mid', () => {
      expect(src).not.toMatch(/\btext-fg-mid\b/)
    })

    it('does not use text-fg-low', () => {
      expect(src).not.toMatch(/\btext-fg-low\b/)
    })

    it('uses admin-namespaced text tokens for the heading', () => {
      expect(src).toMatch(/text-admin-text\b/)
    })

    it('uses admin-namespaced text token for label / secondary copy', () => {
      expect(src).toMatch(/text-admin-text2\b/)
    })

    it('uses admin-namespaced text token for the deadline helper line', () => {
      expect(src).toMatch(/text-admin-text3\b/)
    })

    it('does not hardcode raw black / white text or background colors', () => {
      expect(src).not.toMatch(/\btext-black\b/)
      expect(src).not.toMatch(/\btext-white\b/)
      expect(src).not.toMatch(/\btext-gray-(?:9\d{2})\b/)
      expect(src).not.toMatch(/\bbg-white\b/)
      expect(src).not.toMatch(/\bbg-black\b/)
    })

    it('every <input> declares text-admin-text', () => {
      const inputBlocks = src.match(/<input[\s\S]*?\/>/g) ?? []
      expect(inputBlocks.length).toBeGreaterThan(0)
      for (const block of inputBlocks) {
        expect(block).toMatch(/text-admin-text\b/)
      }
    })

    it('preserves the canonical bg-admin-surface card shell', () => {
      expect(src).toMatch(/bg-admin-surface\b/)
      expect(src).toMatch(/border-admin-border\b/)
    })
  })

  describe('admin source tree at large', () => {
    it('no admin component file references text-fg-high/mid/low (regression target across the namespace)', async () => {
      // Admin components must NOT consume the public-site responsive
      // foreground tokens — those flip to near-black in light mode and the
      // admin shell forces dark surfaces, producing dark-on-dark contrast
      // failures. Use `text-admin-text/text2/text3` instead.
      const { readdirSync, statSync } = await import('fs')
      const offenders: string[] = []

      function walk(dir: string) {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry)
          const stat = statSync(full)
          if (stat.isDirectory()) {
            walk(full)
          } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
            const content = readFileSync(full, 'utf8')
            if (/\btext-fg-(?:high|mid|low)\b/.test(content)) {
              offenders.push(full)
            }
          }
        }
      }

      walk(path.join(process.cwd(), 'src/components/admin'))
      walk(path.join(process.cwd(), 'src/app/admin'))

      expect(offenders).toEqual([])
    })
  })
})
