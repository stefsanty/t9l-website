/**
 * v1.59.2 — regression target for the /account/player hydration crash.
 *
 * Pre-v1.59.2 `PROFILE_PIC_ALLOWED_TYPES` and `PROFILE_PIC_MAX_BYTES`
 * were `export const` from `actions.ts` — a `'use server'` file. Next.js
 * 16 turns every export from a `'use server'` file into a server-action
 * proxy on the client side: the actual values never reach the browser.
 *
 * `AccountPlayerForm` (a client component) imported these "constants"
 * thinking they were a real array and a real number. At runtime in the
 * browser they were functions (server references). The form did:
 *
 *   accept={PROFILE_PIC_ALLOWED_TYPES.join(',')}    // .join is undefined
 *   file.size > PROFILE_PIC_MAX_BYTES                // size > <function>
 *
 * The `.join` call threw `TypeError: ...join is not a function` during
 * client render, hydration crashed, Next.js's default global error UI
 * rendered ("This page couldn't load. Reload to try again, or go back.").
 *
 * The bug pre-dated v1.59.1; it was masked by an over-aggressive admin-
 * shell gate that returned a "can't edit here" branch before the form
 * ever rendered. Once v1.59.1 fixed the gate, hydration crashes started.
 *
 * This test pins three things:
 *   1. The constants live in `validation.ts`, NOT in `actions.ts`.
 *   2. `validation.ts` does NOT have `'use server'` — without that
 *      directive, Next.js leaves the exports as plain values.
 *   3. The runtime values are the actual array / number, with `.join`
 *      and arithmetic semantics intact.
 *
 * If any of these regresses, hydration on /account/player breaks.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const VALIDATION_PATH = join(ROOT, 'src/app/account/player/validation.ts')
const ACTIONS_PATH = join(ROOT, 'src/app/account/player/actions.ts')
const FORM_PATH = join(ROOT, 'src/app/account/player/AccountPlayerForm.tsx')

describe('v1.59.2 — /account/player constants must live outside use-server', () => {
  it('validation.ts does NOT have a `use server` directive', () => {
    const src = readFileSync(VALIDATION_PATH, 'utf-8')
    // First non-empty, non-comment top-level line should never be
    // 'use server'. Strip leading comments + blank lines and check.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '')
      .replace(/^\s*\n/gm, '')
      .trim()
    expect(stripped).not.toMatch(/^['"]use server['"]/)
  })

  it('validation.ts exports the canonical constants', () => {
    const src = readFileSync(VALIDATION_PATH, 'utf-8')
    expect(src).toMatch(/export const PROFILE_PIC_MAX_BYTES\s*=/)
    expect(src).toMatch(/export const PROFILE_PIC_ALLOWED_TYPES\s*=/)
  })

  it('actions.ts does NOT export the constants (regression target)', () => {
    const src = readFileSync(ACTIONS_PATH, 'utf-8')
    // Strip block comments so doc-strings mentioning the constant names
    // don't trip the assertion.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '')
    expect(stripped).not.toMatch(/export\s+const\s+PROFILE_PIC_MAX_BYTES/)
    expect(stripped).not.toMatch(/export\s+const\s+PROFILE_PIC_ALLOWED_TYPES/)
  })

  it('actions.ts imports the constants from ./validation', () => {
    const src = readFileSync(ACTIONS_PATH, 'utf-8')
    expect(src).toMatch(
      /from ['"]\.\/validation['"]/,
    )
  })

  it('AccountPlayerForm imports the constants from ./validation, not ./actions', () => {
    const src = readFileSync(FORM_PATH, 'utf-8')
    // The constants must come from the neutral validation module so the
    // client bundle holds the real values. Importing them from
    // `./actions` would cause `createServerReference` proxies on the
    // client (the regression that broke hydration).
    // Note: `[^}]*` (not `.*`) so the regex works without the `/s` flag —
    // tsconfig target is pre-es2018 in some PR branches.
    expect(src).toMatch(
      /import\s*\{[^}]*PROFILE_PIC_ALLOWED_TYPES[^}]*\}\s*from\s*['"]\.\/validation['"]/,
    )
    expect(src).toMatch(
      /import\s*\{[^}]*PROFILE_PIC_MAX_BYTES[^}]*\}\s*from\s*['"]\.\/validation['"]/,
    )
    // Negative regression: the form must NOT import these from actions.
    const fromActionsBlock = src.match(
      /import\s*\{[^}]+\}\s*from\s*['"]\.\/actions['"]/,
    )
    if (fromActionsBlock) {
      expect(fromActionsBlock[0]).not.toMatch(/PROFILE_PIC_ALLOWED_TYPES/)
      expect(fromActionsBlock[0]).not.toMatch(/PROFILE_PIC_MAX_BYTES/)
    }
  })
})

describe('v1.59.2 — runtime types of the constants are intact', () => {
  it('PROFILE_PIC_ALLOWED_TYPES is an array with .join() (not a server-reference proxy)', async () => {
    const mod = await import('@/app/account/player/validation')
    expect(Array.isArray(mod.PROFILE_PIC_ALLOWED_TYPES)).toBe(true)
    expect(typeof mod.PROFILE_PIC_ALLOWED_TYPES.join).toBe('function')
    // The exact `.join(',')` call that was crashing in the form.
    expect(mod.PROFILE_PIC_ALLOWED_TYPES.join(',')).toBe(
      'image/jpeg,image/png,image/webp',
    )
    expect(mod.PROFILE_PIC_ALLOWED_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ])
  })

  it('PROFILE_PIC_MAX_BYTES is a number that supports comparison', async () => {
    const mod = await import('@/app/account/player/validation')
    expect(typeof mod.PROFILE_PIC_MAX_BYTES).toBe('number')
    expect(mod.PROFILE_PIC_MAX_BYTES).toBe(5 * 1024 * 1024)
    // The exact comparison the form does — would silently misbehave if
    // the value was a function (function > number is always false).
    expect(1 > mod.PROFILE_PIC_MAX_BYTES).toBe(false)
    expect(mod.PROFILE_PIC_MAX_BYTES + 1 > mod.PROFILE_PIC_MAX_BYTES).toBe(true)
  })
})
