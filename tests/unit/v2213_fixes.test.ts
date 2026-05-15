/**
 * v2.2.13 — source-pin tests for the four fixes shipped in this PR.
 *
 *   (1) TeamPickerSection grid is 2-col at every breakpoint (drop `md:`).
 *   (2) Futsal position codes round-trip through `positionPillColor` to
 *       the correct bucket (FIXO→DF/blue, ALA→MF/green, PIVOT→FW/red,
 *       GK→yellow). Pinned alongside every soccer code so a future
 *       bucket regression breaks loudly.
 *   (3) `positionPillColor` emits dual-shade light/dark text classes —
 *       `text-{c}-800 dark:text-{c}-300` — and the MF chip uses the
 *       heavier `bg-green-600/25` body. Light-mode WCAG-AA-friendly.
 *   (4) `/id/[slug]/page.tsx` resolves URL-scoped league fields and
 *       threads them to `<Header>`, which forwards `allowSelfLinkOverride`
 *       to `<LineLoginButton>`, which prefers the override over
 *       `session.allowSelfLink`. Same family as v2.2.5 / v2.2.10 /
 *       v2.2.11 cross-league scoping fixes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { positionPillColor } from '@/lib/positions'

const root = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

describe('v2.2.13 — fix 1: TeamPickerSection grid 2-col at all breakpoints', () => {
  const src = read('src/components/onboarding/TeamPickerSection.tsx')

  it('uses `grid grid-cols-2 gap-3` (no `md:` prefix on grid-cols)', () => {
    expect(src).toMatch(/className="grid grid-cols-2 gap-3"/)
  })

  it('does NOT carry the v2.2.12 `grid-cols-1 md:grid-cols-2` shape', () => {
    expect(src).not.toMatch(/grid-cols-1\s+md:grid-cols-2/)
  })
})

describe('v2.2.13 — fix 2: futsal codes map to the right pill bucket', () => {
  const cases: ReadonlyArray<[string, RegExp]> = [
    ['GK', /yellow/],
    ['FIXO', /blue/],
    ['ALA', /green/],
    ['PIVOT', /red/],
    // case-insensitivity guarantee (getPositionBucket upper-cases)
    ['gk', /yellow/],
    ['fixo', /blue/],
    ['ala', /green/],
    ['pivot', /red/],
  ]

  it.each(cases)('positionPillColor(%s) is in the %s family', (code, family) => {
    expect(positionPillColor(code)).toMatch(family)
  })

  it('every soccer code resolves to a non-empty pill class string', () => {
    const SOCCER = ['GK', 'LB', 'CB', 'RB', 'LM', 'DM', 'CM', 'CAM', 'RM', 'LW', 'ST', 'RW']
    for (const code of SOCCER) {
      expect(positionPillColor(code)).toBeTruthy()
    }
  })
})

describe('v2.2.14 — opaque pills (replaces v2.2.13 translucent dual-shade)', () => {
  it('GK pill is opaque `bg-yellow-200 text-yellow-900`', () => {
    expect(positionPillColor('GK')).toBe('bg-yellow-200 text-yellow-900')
  })

  it('DF/FIXO pill is opaque `bg-blue-200 text-blue-900`', () => {
    expect(positionPillColor('CB')).toBe('bg-blue-200 text-blue-900')
    expect(positionPillColor('FIXO')).toBe('bg-blue-200 text-blue-900')
  })

  it('MF/ALA pill is opaque `bg-green-200 text-green-900`', () => {
    expect(positionPillColor('CM')).toBe('bg-green-200 text-green-900')
    expect(positionPillColor('ALA')).toBe('bg-green-200 text-green-900')
  })

  it('FW/PIVOT pill is opaque `bg-red-200 text-red-900`', () => {
    expect(positionPillColor('ST')).toBe('bg-red-200 text-red-900')
    expect(positionPillColor('PIVOT')).toBe('bg-red-200 text-red-900')
  })

  it('no bucket carries a `dark:` variant (single shape in both modes)', () => {
    for (const code of ['GK', 'CB', 'CM', 'ST', 'FIXO', 'ALA', 'PIVOT']) {
      expect(positionPillColor(code)).not.toMatch(/dark:/)
    }
  })

  it('no bucket uses translucent `/20` or `/25` alpha modifiers', () => {
    for (const code of ['GK', 'CB', 'CM', 'ST', 'FIXO', 'ALA', 'PIVOT']) {
      expect(positionPillColor(code)).not.toMatch(/\/\d+/)
    }
  })
})

describe('v2.2.13 — fix 4: cross-league /id/[slug] scoping (header + self-link)', () => {
  const page = read('src/app/id/[slug]/page.tsx')
  const header = read('src/components/Header.tsx')
  const button = read('src/components/LineLoginButton.tsx')

  it('page selects URL-scoped `name` / `abbreviation` / `allowSelfLink`', () => {
    expect(page).toMatch(/select:\s*\{\s*name:\s*true,\s*abbreviation:\s*true,\s*allowSelfLink:\s*true\s*\}/)
  })

  it('page derives `headerTitle` from `abbreviation ?? name`', () => {
    expect(page).toMatch(/headerTitle\s*=\s*[^]*abbreviation\s*\?\?\s*[^]*\.name/)
  })

  it('page passes `leagueTitle` + `allowSelfLinkOverride` to <Header>', () => {
    expect(page).toMatch(/leagueTitle=\{headerTitle\}/)
    expect(page).toMatch(/allowSelfLinkOverride=\{headerAllowSelfLink\}/)
  })

  it('the resolved header title binding sits on the JSX `<Header` element', () => {
    // Positive shape check: the actual JSX attribute is wired to the
    // resolved `headerTitle` (asserted above). Comments referencing the
    // pre-v2.2.13 `leagueTitle={null}` shape are allowed and load-bearing
    // for context, so we don't fight them with a negative regex.
    expect(page).toMatch(/<Header[\s\S]*?leagueTitle=\{headerTitle\}/)
  })

  it('Header accepts `allowSelfLinkOverride` and forwards it', () => {
    expect(header).toMatch(/allowSelfLinkOverride\?:\s*boolean/)
    expect(header).toMatch(/<LineLoginButton allowSelfLinkOverride=\{allowSelfLinkOverride\}/)
  })

  it('LineLoginButton accepts the override prop', () => {
    expect(button).toMatch(/allowSelfLinkOverride\?:\s*boolean/)
    expect(button).toMatch(/LineLoginButton\(\{\s*allowSelfLinkOverride\s*\}/)
  })

  it('LineLoginButton resolves the gate with override > session', () => {
    // both code paths (popup useEffect + dropdown gate) must use the
    // override-first resolution rather than session.allowSelfLink direct
    expect(button).toMatch(/allowSelfLinkOverride !== undefined/)
    // dropdown branch keeps the legacy default-true fallback
    expect(button).toMatch(/session\.allowSelfLink !== false/)
  })
})
