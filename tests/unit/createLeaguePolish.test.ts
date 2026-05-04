import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

/**
 * v1.53.1 (PR 5 of the path-routing chain) — admin CreateLeagueModal
 * polish + server-side reserved-word validation.
 *
 * Pinned contracts:
 *   - createLeague server action validates slug via validateLeagueSlug
 *     before hitting Prisma.
 *   - updateLeagueInfo validates slug when it's being changed (not when
 *     clearing or leaving unchanged).
 *   - /api/subdomains/check returns reason-keyed responses so the modal
 *     can surface targeted error copy.
 *   - CreateLeagueModal:
 *     - Imports validateLeagueSlug for client-side mirror.
 *     - URL preview shows /league/<slug>, NOT <slug>.t9l.me.
 *     - Warning copy "Cannot be changed after creation." present.
 *     - Surface targeted error copy per failure reason.
 *     - Submit blocked when status is 'invalid' or 'taken'.
 */

function read(relPath: string): string {
  return readFileSync(path.join(process.cwd(), relPath), 'utf8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('PR 5 — createLeague server action validates slug', () => {
  const actionsPath = 'src/app/admin/leagues/actions.ts'

  it('imports validateLeagueSlug from @/lib/leagueSlug', () => {
    const src = stripComments(read(actionsPath))
    expect(src).toMatch(/validateLeagueSlug/)
  })

  it('createLeague calls validateLeagueSlug when subdomain is non-null', () => {
    const src = stripComments(read(actionsPath))
    // Match the createLeague block specifically by anchoring after the
    // function signature.
    expect(src).toMatch(/export\s+async\s+function\s+createLeague[\s\S]*validateLeagueSlug\(subdomain\)[\s\S]*v\.ok/)
  })

  it('createLeague throws with the validation reason when invalid', () => {
    const src = stripComments(read(actionsPath))
    expect(src).toMatch(/Invalid league slug:\s*\$\{v\.reason\}/)
  })

  it('updateLeagueInfo validates slug when being changed', () => {
    const src = stripComments(read(actionsPath))
    expect(src).toMatch(/export\s+async\s+function\s+updateLeagueInfo[\s\S]*validateLeagueSlug\(data\.subdomain\)/)
  })

  it('updateLeagueInfo allows null/empty slug (clearing the field)', () => {
    const src = stripComments(read(actionsPath))
    // The validation guard checks for non-null, non-empty before validating.
    expect(src).toMatch(/data\.subdomain\s*!==\s*undefined\s*&&\s*data\.subdomain\s*!==\s*null\s*&&\s*data\.subdomain\s*!==\s*['"]['"]/)
  })
})

describe('PR 5 — /api/subdomains/check returns reason-keyed responses', () => {
  const routePath = 'src/app/api/subdomains/check/route.ts'

  it('exists', () => {
    expect(existsSync(path.join(process.cwd(), routePath))).toBe(true)
  })

  it('imports validateLeagueSlug', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/validateLeagueSlug/)
  })

  it('returns { available: false, reason: "empty" } on missing input', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/available:\s*false,\s*reason:\s*['"]empty['"]/)
  })

  it('returns { available: false, reason: <validation.reason> } when validation fails', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/available:\s*false,\s*reason:\s*validation\.reason/)
  })

  it('returns { available: false, reason: "in-use" } on DB collision', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/available:\s*false,\s*reason:\s*['"]in-use['"]/)
  })

  it('returns { available: true } when validation passes and no DB row collides', () => {
    const src = stripComments(read(routePath))
    expect(src).toMatch(/available:\s*true/)
  })
})

describe('PR 5 — CreateLeagueModal slug field UX', () => {
  const modalPath = 'src/components/admin/CreateLeagueModal.tsx'

  it('imports validateLeagueSlug for client-side mirror', () => {
    const src = stripComments(read(modalPath))
    expect(src).toMatch(/import.*validateLeagueSlug.*from\s+['"]@\/lib\/leagueSlug['"]/)
  })

  it('URL preview shows /league/<slug>, NOT <slug>.t9l.me (regression target — subdomain UX is gone)', () => {
    const src = stripComments(read(modalPath))
    expect(src).toMatch(/\/league\//)
    expect(src).not.toMatch(/\.t9l\.me/)
  })

  it('warning copy "Cannot be changed after creation" is present', () => {
    const src = stripComments(read(modalPath))
    expect(src).toContain('Cannot be changed after creation')
  })

  it('warning copy element carries data-testid for e2e', () => {
    const src = stripComments(read(modalPath))
    expect(src).toContain('data-testid="create-league-slug-warning"')
  })

  it('exposes the slug input testid', () => {
    const src = stripComments(read(modalPath))
    expect(src).toContain('data-testid="create-league-slug-input"')
  })

  it('exposes the slug status testid', () => {
    const src = stripComments(read(modalPath))
    expect(src).toContain('data-testid="create-league-slug-status"')
  })

  it('renders targeted error copy per validation reason (REASON_COPY map)', () => {
    const src = stripComments(read(modalPath))
    expect(src).toMatch(/REASON_COPY[\s\S]*'too-short'/)
    expect(src).toMatch(/REASON_COPY[\s\S]*reserved/)
    expect(src).toMatch(/REASON_COPY[\s\S]*'invalid-format'/)
  })

  it('disables submit when status is invalid or taken', () => {
    const src = stripComments(read(modalPath))
    expect(src).toMatch(/submitDisabled/)
    expect(src).toMatch(/subStatus\.kind\s*===\s*['"]taken['"]/)
    expect(src).toMatch(/subStatus\.kind\s*===\s*['"]invalid['"]/)
  })

  it('label updated from "Subdomain" to "URL slug"', () => {
    const src = stripComments(read(modalPath))
    expect(src).toContain('URL slug')
  })

  it('client-side validation runs BEFORE the fetch (instant feedback for malformed input)', () => {
    const src = stripComments(read(modalPath))
    // The local `validateLeagueSlug(slug)` call must execute before the
    // setTimeout-wrapped fetch so admins see "too short" / "reserved"
    // / "invalid-format" feedback without a server round-trip.
    expect(src).toMatch(/validateLeagueSlug\(slug\)[\s\S]{0,400}setTimeout/)
  })
})
